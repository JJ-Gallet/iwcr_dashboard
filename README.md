## Introduction
This is a repository which contains the dashboard code to visualise graphics gererated using iwcr visualisation tools.

It needs to be feed with a directory/ contains a directory whit pictures to visualise. These pictures have to follow strict
naming conventions.

The code was created almost exclusivly using AI as a means to be able to go threw graphics and compare them in an efficient way.

The correctness of data is ensured as the pictures are generated seperatly with a handwritten script which also stamps graphics
with time and location

## Adding Graphics

New graphics need to be added in ./public/graphics .

Naming convention : product_model_date_time_location.png  
Files never need all arguments. eg. lidar does not contain a time as it represents a daily timeseries, on the otherhand rain needs a time but no location.

### It is important that tools/build_catalog.py is executed to add picutres to the cataloge wich makes them able to be displayed.
