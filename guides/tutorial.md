# Tutorial

In this guide I will try to cover the very basics of 3D graphics and WebGL.
This tutorial is designed for people with good maths knowledge by that lack the experience of developing interactive 3D applications.
Because it is based in WebGL it also covers the basics of web interactive development.

# Basics of 3D programming

To understand well 3D programming it is important to understand some points related to hardware, mathmatics and programming.
Without this knowledge the user won't be able to understand the reasoning behing some decisions.

## The Maths of 3D

When working on 3D we are going to use mathmatics constantly (to transform objects, determine the color of every pixel, project to 2D, etc).
This mathmatics are not very complex and could be understood easily if you have some basic knowledge of algebra.

Most of the numerical transformations applied to 3D coordinates (like moving, scaling, rotating, but also projecting to screen) can be performed using a simple matrix44 multiplication.
Thats why matrices are very useful in 3D programming, we can use them every time we have to transform some data.

In the next chapters we will study the most important transformations.

## 3D transformations

When working on 3D every object we render is defined by a set of points (vertices) in 3D space.
But as a programmer you want to have the freedom to position those objects in the 3D space (moving them, rotating them or changing its scale).
To perform those actions we apply the same transformation to every single vertex. For instance, if we want to move an object up, we increase the Y component by the same ammount in all the vertices.

Sometimes we want to apply several transformations, and some of them could be tricky to do (like rotating and translating).

## From 3D to 2D

First we have to understand that when creating 3D applications we are drawing a 3D scene in a 2D screen,
so we need to have some sort of projection mechanism to transform from 3D space to 2D space.
This process is usually done by multiplying every 3D point by a projection matrix.


# The Raster

There working with 3D rendering there are two ways to approach it, using raster or using ray-tracing, in this guide we will focus on raster which is the way current GPUs work.
The idea is to have a scene represented by triangles (every object must be decomposed in triangles), then:
- for every triangle on the scene
  - project 3D coordinates to screen
  - fill the triangle


# The render pipeline

# GPU


